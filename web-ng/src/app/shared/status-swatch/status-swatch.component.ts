import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { STATUS_KEYS, type StatusKey } from '../status-key.util';

/** The four keys of the status indicator, re-exported from `web-ng/src/app/shared/status-key.util.ts` so that this component's own public input type stays importable from this module (AAP 0.2.3 `StatusSwatch` row) (AAP 0.14.1). */
export type { StatusKey };

/** The two geometries the design gives the same indicator: `swatch` is the 12.5px square of the clients list's Status column (Figma node `1:3`), `dot` the 20.5px circle beside the client name on the record header (Figma node `1:4`) — AAP 0.2.3 row `StatusSwatch`. */
export type StatusSwatchVariant = 'swatch' | 'dot';

/** The global colour class each key maps to: the names `web-ng/src/styles.scss` declares, and that file owns every colour of the indicator — the `color-status-active` and `color-status-pending` tokens of AAP 0.2.2 plus the two complementary states — so no colour value appears in this component (Rule 1 clause 6). */
const STATUS_CLASSES: Readonly<Record<StatusKey, string>> = {
  active: 'status-active', pending: 'status-pending', closed: 'status-closed', other: 'status-other', };

/** The colour class for a key, falling back to `status-other` for a value outside the union so that an unknown key still renders the indicator's geometry in a neutral colour rather than failing, and never contributes text of its own to the class list; the guard exists for a value arriving from untyped data at run time, because `strictTemplates` type-checks the template's own binding. */
function statusClass(key: StatusKey): string {
  return STATUS_KEYS.has(key) ? STATUS_CLASSES[key] : STATUS_CLASSES.other;
}

/** The design's status indicator for a client: a colour swatch and never a word (AAP 0.2.3 `StatusSwatch` row, AAP 0.5.4 gaps inventory row "Status indicator", AAP 0.7.1 shared row `StatusSwatchComponent`) (Rule 1 clause 6, AAP 0.4.4, AAP 0.10.5, Rule 1 clause 3). */
@Component({ selector: 'app-status-swatch', changeDetection: ChangeDetectionStrategy.OnPush, templateUrl: './status-swatch.component.html', })
export class StatusSwatchComponent {
  /** The client's status, one of the four keys of AAP 0.2.3 row `StatusSwatch`; required because the design paints no status-free swatch, so omitting the key from a caller's template is a `strictTemplates` error rather than a silently wrong colour. */
  readonly status = input.required<StatusKey>();
  /** `swatch` for the 12.5px square of the clients list (Figma node `1:3`), `dot` for the 20.5px circle of the client record header (Figma node `1:4`); the default is the list's square, the form a list screen renders once per row. */
  readonly variant = input<StatusSwatchVariant>('swatch');
  /** The class list the template's single span binds: the base `status-swatch`, `status-dot` for the record variant, and exactly one colour class — space-separated, with no leading, trailing or repeated space — computed so the two inputs are resolved and validated once and the template never assembles a class name from a raw input. */
  protected readonly classes = computed<string>(() => {
    const variantClass = this.variant() === 'dot' ? ' status-dot' : '';
    return `status-swatch${variantClass} ${statusClass(this.status())}`;
  });
}
