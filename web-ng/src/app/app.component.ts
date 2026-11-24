import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { NotificationComponent } from './shared/notification/notification.component';

/**
 * Application root (AAP 0.8.2 "Application entry and configuration", AAP 0.11.1 row 12): the
 * component `web-ng/src/main.ts` passes to `bootstrapApplication`, and the element
 * `web-ng/src/index.html` mounts as `<app-root>`.
 *
 * It owns two hosts and nothing else — the router outlet that renders the active route, and the
 * application's single notification host. The notification host sits here rather than in the
 * shell because notices must be visible on every route, including the login screen, which renders
 * outside the signed-in chrome; keeping it here is also what makes it the only instance in the
 * document (AAP 0.7.1 `NotificationComponent`). The signed-in chrome — navbar, breadcrumb, content
 * background — belongs to `core/layout/shell.component.ts` behind the layout route, so this
 * component adds no wrapper element of its own: a wrapper would sit between the shell's fixed
 * navbar and the routed content and break that layout.
 *
 * The shell is styled by the global legacy stylesheet (`web-ng/src/styles.scss`), so the component
 * declares no styles and no providers; `app.config.ts` is the single composition point for the
 * router, HTTP and i18n (Rule 1 clause 5). OnPush is explicit because the application runs
 * zoneless (AAP 0.4.1) and every view here is signal-driven.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, NotificationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.component.html',
})
export class AppComponent {}
