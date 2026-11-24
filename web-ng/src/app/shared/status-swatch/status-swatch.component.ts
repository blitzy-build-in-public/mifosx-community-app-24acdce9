import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * The four keys of the client status indicator (AAP 0.2.3 component inventory row
 * `StatusSwatch`).
 *
 * The vocabulary is this component's own, not Fineract's: mapping a status code
 * (`clientStatusType.active`, `clientStatusType.pending`, …) onto one of these keys belongs to
 * the calling feature, so `shared/` carries no status-code switch and no i18n (AAP 0.14.1).
 * `active` and `pending` are the two states the design paints (Figma nodes `1:3` and `1:4`);
 * `closed` and `other` are the complementary styling for records the design does not show, and
 * they differ by colour only.
 */
export type StatusKey = 'active' | 'pending' | 'closed' | 'other';

/**
 * The two geometries the design gives the same indicator: `swatch` is the 12.5px square of the
 * clients list's Status column (Figma node `1:3`), `dot` is the 20.5px circle beside the client
 * name on the record header (Figma node `1:4`). AAP 0.2.3 row `StatusSwatch`.
 */
export type StatusSwatchVariant = 'swatch' | 'dot';

/**
 * Every legal `StatusKey`, against which a key is validated before it reaches the element's
 * class list. The template cannot produce an illegal key — `strictTemplates` type-checks the
 * binding against the union — so the guard exists for a value that arrives from untyped data at
 * run time, where interpolating the raw input would write arbitrary text into the class list.
 */
const STATUS_KEYS: ReadonlySet<StatusKey> = new Set<StatusKey>([
  'active',
  'pending',
  'closed',
  'other',
]);

/**
 * The global colour class each key maps to. The names are the ones `web-ng/src/styles.scss`
 * declares, and that file owns every colour of the indicator — the `color-status-active` and
 * `color-status-pending` tokens of AAP 0.2.2 plus the two complementary states — so no colour
 * value appears in this component (Rule 1 clause 6).
 */
const STATUS_CLASSES: Readonly<Record<StatusKey, string>> = {
  active: 'status-active',
  pending: 'status-pending',
  closed: 'status-closed',
  other: 'status-other',
};

/**
 * The colour class for a key, falling back to `status-other` for a value outside the union so
 * that an unknown key still renders the indicator's geometry in a neutral colour rather than
 * failing, and never contributes text of its own to the class list.
 */
function statusClass(key: StatusKey): string {
  return STATUS_KEYS.has(key) ? STATUS_CLASSES[key] : STATUS_CLASSES.other;
}

/**
 * The design's status indicator for a client: a colour swatch and never a word (AAP 0.2.3
 * component inventory row `StatusSwatch`, AAP 0.5.4 gaps inventory row "Status indicator",
 * AAP 0.7.1 shared row `StatusSwatchComponent`).
 *
 * It serves two painted elements of the same Figma flow: the Status column of the clients list
 * (`swatch`, node `1:3`, a 12.5px square with square corners, the active colour on four rows and
 * the pending colour on one) and the dot beside the client name on the record header (`dot`,
 * node `1:4`, a 20.5px circle). The template is a single span and this file declares no styles:
 * the geometry and every colour come from the global classes of `web-ng/src/styles.scss` (Rule 1
 * clause 6, AAP 0.4.4 decision 4), which is why the component reuses the legacy Bootstrap 3 look
 * instead of drawing anything of its own.
 *
 * The indicator is colour only. It carries no status word, label, `title`, tooltip, icon,
 * border treatment or animation, because the design paints none and adding one would be an
 * improvement the migration may not make (AAP 0.10.5 deliberate difference 11, Rule 1 clause 3);
 * the span is decorative and `aria-hidden`, so the accessible content of a row or record stays
 * with the caller that owns it.
 *
 * Stateless and dependency-free: no injected collaborator, no lifecycle hook, no DOM access and
 * no signal that writes — the component is the pure projection of its two inputs.
 */
@Component({
  selector: 'app-status-swatch',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './status-swatch.component.html',
})
export class StatusSwatchComponent {
  /**
   * The client's status, one of the four keys of AAP 0.2.3 row `StatusSwatch`. Required because
   * the design paints no status-free swatch: omitting the key from a caller's template is a
   * `strictTemplates` error rather than a silently wrong colour.
   */
  readonly status = input.required<StatusKey>();

  /**
   * `swatch` for the 12.5px square of the clients list (Figma node `1:3`), `dot` for the 20.5px
   * circle of the client record header (node `1:4`). The default is the list's square, the form
   * a list screen renders once per row.
   */
  readonly variant = input<StatusSwatchVariant>('swatch');

  /**
   * The class list the template's single span binds: the base `status-swatch`, `status-dot` for
   * the record variant, and exactly one colour class — space-separated, with no leading,
   * trailing or repeated space. Computed so the two inputs are resolved and validated once, and
   * so the template never assembles a class name from a raw input.
   */
  protected readonly classes = computed<string>(() => {
    const variantClass = this.variant() === 'dot' ? ' status-dot' : '';
    return `status-swatch${variantClass} ${statusClass(this.status())}`;
  });
}
