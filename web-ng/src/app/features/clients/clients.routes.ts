/**
 * The clients feature's route group — the five legacy paths that make up workflows W2 and W3, declared
 * in full and mounted by `app.routes.ts` on the empty path, so each URL is exactly the legacy URL it
 * cuts over (AAP 0.8.2 "Feature routes, matching legacy paths exactly"; AAP 0.7.1 Features row
 * `clients`; `web-ng/tools/parity/in-scope-routes.json`).
 *
 * | Path | Screen | Access code |
 * |---|---|---|
 * | `clients` | the list, and the post-login landing screen | `READ_CLIENT` (declared, not guarded — see below) |
 * | `createclient` | the create form | `CREATE_CLIENT` |
 * | `editclient/:id` | the edit form | `UPDATE_CLIENT` |
 * | `viewclient/:id` | the record, with its summary, accounts, identifiers and actions | `READ_CLIENT` |
 * | `client/:id/:action` | one lifecycle action's form (`activate`, `close`, `reject`, `withdraw`, `reactivate`) | `READ_CLIENT` |
 *
 * **One declaration per route, two consumers.** Each route states its code in `data['permission']`.
 * `permissionGuard` reads it here, and the navbar reads the same declaration through the code it
 * states on the Clients entry, so a menu entry cannot outlive its route (AAP 0.14.1, AAP 0.8.2).
 *
 * **Why the list route carries the code but not the guard.** `permissionGuard` answers a denied
 * navigation with the clients list (`DENIED_ROUTE` in `core/auth/permission.guard.ts`), which is the
 * one destination the in-scope route list allows it. Guarding that destination with a code would
 * replace the denial redirect with a second denial aimed at itself, so the route declares the code its
 * navigation entry is gated on and leaves the guard to the screens a user navigates to from it. The
 * list is reachable exactly as the legacy `/clients` route was reachable — legacy guarded the menu
 * entry, not the path (Rule 1 clause 3).
 *
 * **Why the action route declares the read code.** The legacy action route carried no route guard of
 * its own: the buttons that led to it were gated per command (`ACTIVATE_CLIENT`, `CLOSE_CLIENT`, …) and
 * Fineract enforced the command itself. The record screen still gates each of those links with the
 * command's own code, so declaring the family's read code here gates the entry to the screen without
 * denying a user a command the server would have accepted.
 */
import type { Routes } from '@angular/router';

import { permissionGuard } from '../../core/auth/permission.guard';
import { ClientActionsComponent } from './client-actions/client-actions.component';
import { ClientCreateComponent } from './client-create/client-create.component';
import { ClientEditComponent } from './client-edit/client-edit.component';
import { ClientListComponent } from './client-list/client-list.component';
import { ClientViewComponent } from './client-view/client-view.component';

/**
 * The clients family's five screens under their legacy paths.
 *
 * Exported as the array `app.routes.ts` loads lazily, so the family's paths, its access codes and its
 * breadcrumb keys are declared in one place and the parity route list has one thing to agree with.
 * The record route is the one screen that declares no breadcrumb key, because it paints its own trail
 * from the client's office; the comment on that entry states why.
 */
export const CLIENTS_ROUTES: Routes = [
  {
    path: 'clients',
    component: ClientListComponent,
    data: { permission: 'READ_CLIENT', breadcrumb: ['label.anchor.clients'] },
  },
  {
    path: 'createclient',
    component: ClientCreateComponent,
    canActivate: [permissionGuard],
    data: {
      permission: 'CREATE_CLIENT',
      breadcrumb: ['label.anchor.clients', 'label.heading.createclient'],
    },
  },
  {
    path: 'editclient/:id',
    component: ClientEditComponent,
    canActivate: [permissionGuard],
    data: {
      permission: 'UPDATE_CLIENT',
      breadcrumb: ['label.anchor.clients', 'label.heading.editclient'],
    },
  },
  {
    path: 'viewclient/:id',
    component: ClientViewComponent,
    canActivate: [permissionGuard],
    // The record is the one screen that declares no `breadcrumb`: it paints its own trail from the
    // client's office (`ClientViewComponent.officeCrumb`), which is what the legacy record template
    // shows — `{{client.officeName}}` in its `.breadcrumb`, `app/views/clients/viewclient.html:2-5`,
    // and AAP 0.7.4's "Breadcrumb `Head Office /`". A static trail here would paint a second one above
    // it and describe the route instead of the client on screen.
    data: { permission: 'READ_CLIENT' },
  },
  {
    path: 'client/:id/:action',
    component: ClientActionsComponent,
    canActivate: [permissionGuard],
    data: {
      permission: 'READ_CLIENT',
      breadcrumb: ['label.anchor.clients', 'label.heading.client'],
    },
  },
];
