import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Explicit empty state for list and record surfaces (AAP 0.7.4): centred muted text with no error, rendered inside the caller's `.panel-body`; the look comes from Bootstrap 3's global `.text-center` and `.text-muted`, which is why the component declares no styles of its own. */
@Component({ selector: 'app-empty-state', changeDetection: ChangeDetectionStrategy.OnPush, templateUrl: './empty-state.component.html', })
export class EmptyStateComponent {
  /** Display text already translated by the calling feature template. */
  readonly message = input.required<string>();
}
