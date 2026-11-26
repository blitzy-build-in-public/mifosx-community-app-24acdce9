import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The card every list, record and form surface is drawn on (AAP 0.2.3 component inventory row `PanelCard`,
 * Figma nodes `1:3` — the clients list — and `1:4` — the client record): the white, shadowed surface with an
 * optional heading band, provided once so the card has a single place to change.
 *
 * It is an attribute on the caller's own `div` — `div[appPanelCard]`, not an `app-panel-card` element — so a
 * caller writes the card exactly as the Bootstrap 3 markup the migration reproduces writes it:
 * `<div appPanelCard>` renders `div.panel` and its heading the same `div.panel-heading > h3.panel-title`
 * chain legacy produces, nothing being introduced between the caller's `div` and its content (Rule 1 clause
 * 6, AAP 0.5.2 row "Card / panel").
 *
 * The look stays in the design system: `web-ng/src/styles.scss` paints `.panel` with the `color-surface`,
 * `radius-card` and `shadow-card` tokens (AAP 0.2.2), gives `.panel > .panel-heading` its 1px
 * `color-section-rule` rule and its white band, and paints `.panel-bordered` with the 1px `color-rule` stroke
 * the record's profile card shows (AAP 0.5.2, AAP 0.5.3). This component declares no stylesheet, no `style`
 * attribute, no colour and no dimension: it only decides which classes the host wears and where the heading
 * goes (Rule 1 clause 6, AAP 0.5.5).
 *
 * Three variants, all already present in the delivered markup, which is why the component carries them rather
 * than choosing one: `plain` is the bare `.panel` of the list, search and form cards, `default` adds
 * Bootstrap's `.panel-default`, and `bordered` adds `.panel-bordered` for the record's profile card. It is
 * stateless and dependency-free — no injected collaborator, no lifecycle hook, no written signal — the pure
 * projection of its three inputs.
 */
@Component({
  selector: 'div[appPanelCard]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './panel-card.component.html',
  host: {
    class: 'panel',
    '[class.panel-default]': "variant() === 'default'",
    '[class.panel-bordered]': "variant() === 'bordered'",
  },
})
export class PanelCardComponent {
  /**
   * The card's heading text, already translated by the calling feature template (AAP 0.2.3's
   * `title?: string`). `null` — the default — renders no heading band at all, which is what the
   * cards without a title need; an empty string renders none either, because a band carrying no
   * text would paint the rule without saying anything.
   *
   * A caller whose heading is not a plain string — the search results screen echoes the query
   * beside the title — leaves this unset and projects its own `.panel-heading` instead.
   */
  readonly title = input<string | null>(null);

  /**
   * The heading element of the band: `h3` by default, which is the card title of the list, search,
   * form and action cards, and `h4` for the record's profile card, whose title the delivered markup
   * sets at that level (Figma node `1:4`). Bootstrap styles both as `.panel-title`.
   */
  readonly titleTag = input<'h3' | 'h4'>('h3');

  /**
   * Which of the three class variants of the delivered markup the card wears: `plain` for `.panel`
   * alone, `default` for `.panel.panel-default`, `bordered` for `.panel.panel-bordered` (the
   * record's profile card). See the class doc for the screens each one serves.
   */
  readonly variant = input<'plain' | 'default' | 'bordered'>('plain');
}
