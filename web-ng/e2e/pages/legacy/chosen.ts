/**
 * Legacy-only page-object helper for the `chosen` dropdown widget of the legacy AngularJS application.
 *
 * Legacy templates mark each dropdown with the `chosen` attribute (app/views/clients/createclient.html
 * and its siblings) and the plugin replaces the `<select>` with markup of its own. The new application
 * uses a native `<select>` instead (AAP 0.10.5 item 2), so this helper is deliberately legacy-only:
 * there is no counterpart under `pages/next/`, and only `clients.page.ts`, `loans.page.ts` and
 * `savings.page.ts` import it.
 *
 * Everything here drives the plugin the legacy page loads from app/scripts/modules/ through
 * app/scripts/loader.js (AAP 0.3.4, Chosen v1.0.0). The legacy source tree is a read-only reference
 * outside this checkout, so every selector, class and event below carries the fact it comes from and
 * must be confirmed against the running legacy app.
 */
import type { Locator, Page } from '@playwright/test';

/**
 * One option of the `<select>` underneath the chosen widget.
 *
 * Exported so the legacy page objects can describe a dropdown without touching the plugin, and so the
 * shape is available to the `next` side if a screen ever compares labels against it.
 */
export interface ChosenOption {
  /** The `<option>` value, which is what the legacy form posts to Fineract. */
  value: string;
  /** The visible label, trimmed the way this helper matches it. */
  label: string;
}

/**
 * The container chosen builds beside the `<select>`.
 *
 * Chosen v1.0.0 inserts it with `form_field_jq.hide().after(this.container)`, so the widget is the
 * select's next sibling while the select itself is hidden. Confirm against the running legacy app.
 */
const CHOSEN_CONTAINER = 'xpath=following-sibling::div[contains(@class,"chosen-container")]';

/**
 * The anchor that renders the current selection inside the widget.
 *
 * Chosen v1.0.0 single-select markup is `<a class="chosen-single">…</a>`. Confirm against the running
 * legacy app.
 */
const CHOSEN_SINGLE = 'a.chosen-single';

/**
 * The label element inside that anchor.
 *
 * Chosen v1.0.0 renders `<a class="chosen-single"><span>label</span><div><b></b></div></a>`, where the
 * `<div><b></b></div>` is the caret; only the `<span>` carries the selection. Confirm against the
 * running legacy app.
 */
const CHOSEN_SINGLE_LABEL = 'a.chosen-single span';

/**
 * One selectable row in the open dropdown.
 *
 * Chosen v1.0.0 renders `<ul class="chosen-results">` holding one `<li class="active-result">` per
 * selectable option (a disabled option gets `disabled-result` instead and is not selectable), each with
 * its option's text. Confirm against the running legacy app.
 */
const CHOSEN_RESULT = '.chosen-results li.active-result';

/**
 * How long the widget is given to repaint its label after it is told the `<select>` changed, before
 * this helper drives the widget itself. AngularJS digests the dispatched `change` asynchronously, so
 * the label can lag the select by a tick; a miss is expected on builds that repaint only from the
 * plugin's own state, and sends the caller down the fallback path rather than failing.
 */
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

/**
 * Runs inside the legacy page, so it references nothing from module scope — Playwright serialises the
 * function and evaluates it in the document.
 *
 * Selects the `<option>` whose trimmed, case-insensitive label matches `optionText`, reporting the
 * selection to AngularJS and to the plugin, and describes what it found so the caller can verify the
 * rendered result and raise a message naming the options instead of the markup.
 */
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
  // AngularJS's ng-model updates from a bubbling `change`, which is what makes the legacy form carry
  // the new value into its payload.
  element.dispatchEvent(new Event('change', { bubbles: true }));
  // Chosen repaints its own widget only when the `$` function it depends on is told the select changed.
  // This calls the copy the legacy page has already loaded and adds no dependency of its own (Rule 1
  // clause 7). `$` carries no typings for this project, so `window` is narrowed at this documented
  // boundary (Rule 1 clause 4).
  const host = window as unknown as {
    $?: (element: Element) => { trigger?: (event: string) => void } | undefined;
  };
  host.$?.(element)?.trigger?.('chosen:updated');
  element.blur();
  return { status: 'selected', selectName, label: option.text.trim(), labels };
}

/**
 * Runs inside the legacy page: the label of every `<option>` in document order, or `null` when the
 * locator resolved to something other than a `<select>`.
 */
function readOptionLabels(element: HTMLElement): string[] | null {
  if (!(element instanceof HTMLSelectElement)) return null;
  return Array.from(element.options).map((option) => option.text.trim());
}

/**
 * Runs inside the legacy page: the label the widget displays, read from the anchor's `<span>` and never
 * from the caret beside it.
 */
function readSingleLabel(element: HTMLElement): string {
  // Chosen v1.0.0 keeps `chosen-default` on the anchor for as long as the anchor shows the plugin's
  // placeholder rather than an option (single_set_selected_text), so that state is no selection at all.
  // Confirm against the running legacy app.
  if (element.classList.contains('chosen-default')) return '';
  const label = element.querySelector('span');
  return label === null ? '' : (label.textContent ?? '').trim();
}

/**
 * Runs inside the legacy page: whether the plugin has its dropdown open.
 */
function isDropOpen(element: HTMLElement): boolean {
  // Chosen v1.0.0's results_show adds `chosen-with-drop` to the container and results_hide removes it,
  // and it is the container class that the plugin's stylesheet reveals the dropdown from. Confirm
  // against the running legacy app.
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
  // Scoped to the anchor's label element and exact, so an open dropdown listing the same text in its
  // result rows cannot be mistaken for the widget's rendered selection.
  const shown = select
    .locator(CHOSEN_CONTAINER)
    .locator(`${CHOSEN_SINGLE_LABEL}:text-is(${JSON.stringify(label)})`);
  return shown.first().waitFor({ state: 'visible', timeout: WIDGET_REDRAW_TIMEOUT_MS }).then(
    () => true,
    () => false,
  );
}

/** Opens the widget's dropdown, whichever click the plugin's current state needs. */
async function openChosenDrop(widget: Locator, selectName: string): Promise<void> {
  // Chosen toggles the dropdown on every mousedown inside the container, so a single click on the
  // anchor is the user's own way of opening it.
  await widget.locator(CHOSEN_SINGLE).click();
  if (await widget.evaluate(isDropOpen)) return;
  // The click landed while the plugin already held the field active and closed the dropdown instead;
  // a click on the container itself reopens it.
  await widget.click();
  if (await widget.evaluate(isDropOpen)) return;
  throw new Error(`The chosen dropdown on ${selectName} did not open.`);
}

/**
 * Selects the option of a legacy chosen dropdown by its visible label.
 *
 * The real `<select>` is set first and AngularJS and the plugin are told about it; the label the widget
 * renders is then verified, and when it still shows the previous label the dropdown is driven the way a
 * user drives it. Throws when the label matches no option or more than one, and when the widget cannot
 * be made to display the selection — naming the requested text and the available labels, never page
 * markup.
 *
 * @param page The legacy page, used to close the dropdown this helper may have opened.
 * @param select Locator for the legacy `<select>` the chosen widget wraps.
 * @param optionText The option's visible label, matched trimmed and case-insensitively.
 */
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

/**
 * The visible labels of every option the legacy chosen dropdown offers, in document order.
 *
 * @param page Kept so every helper in this module takes the same arguments; the labels come from the
 * options the widget wraps.
 * @param select Locator for the legacy `<select>` the chosen widget wraps.
 */
export async function readChosenOptions(page: Page, select: Locator): Promise<string[]> {
  const labels = await select.evaluate(readOptionLabels);
  if (labels === null) {
    throw new Error('readChosenOptions needs the legacy <select> the widget wraps, not another element.');
  }
  return labels;
}

/**
 * The label the legacy chosen widget displays, or `''` when no option is selected.
 *
 * Reports what the widget renders rather than what the `<select>` holds, which is what {@link chooseOption}
 * verifies after each of its two phases.
 *
 * @param page Kept so every helper in this module takes the same arguments; the label is read from the
 * widget beside `select`.
 * @param select Locator for the legacy `<select>` the chosen widget wraps.
 */
export async function readChosenSelection(page: Page, select: Locator): Promise<string> {
  return readWidgetLabel(select);
}
