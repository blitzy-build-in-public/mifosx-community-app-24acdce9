/** The clients feature's route group — the five legacy paths that make up workflows W2 and W3, declared in full and mounted by `app.routes.ts` on the empty path, so each URL is exactly the legacy URL it cuts over (AAP (AAP 0.8.2, AAP 0.7.1, AAP 0.14.1, Rule 1 clause 3). */
import type { Routes } from '@angular/router';

import { permissionGuard } from '../../core/auth/permission.guard';
import { ClientActionsComponent } from './client-actions/client-actions.component';
import { ClientCreateComponent } from './client-create/client-create.component';
import { ClientEditComponent } from './client-edit/client-edit.component';
import { ClientListComponent } from './client-list/client-list.component';
import { ClientViewComponent } from './client-view/client-view.component';
import { CLIENT_ACTION_PERMISSIONS } from './client.models';

/** The clients family's five screens under their legacy paths. Exported as the array `app.routes.ts` loads lazily, so the family's paths, its access codes and its breadcrumb keys are declared in one place and the parity. */
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
    // The record is the one screen that declares no `breadcrumb`: it paints its own trail from the client's office (`ClientViewComponent.officeCrumb`), which is what the legacy record template shows — `{{client.officeName}}` (AAP 0.7.4).
    data: { permission: 'READ_CLIENT' },
  },
  {
    path: 'client/:id/:action',
    component: ClientActionsComponent,
    canActivate: [permissionGuard],
    data: {
      // The code the `:action` segment names, from the map the action screen's submit control and the record's action entry read as well, so all three enforce one code (AAP 0.1.1).
      permission: { param: 'action', codes: CLIENT_ACTION_PERMISSIONS },
      breadcrumb: ['label.anchor.clients', 'label.heading.client'],
    },
  },
];
