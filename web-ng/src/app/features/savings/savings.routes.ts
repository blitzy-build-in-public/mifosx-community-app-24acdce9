/** W8's three legacy savings paths (`new_client_saving_application/:clientId`, `viewsavingaccount/:id`, `savingaccount/:id/:action`), each carrying its own `CREATE_/READ_SAVINGSACCOUNT` code, `permissionGuard` and legacy `label.*` breadcrumb keys (AAP 0.7.1 savings row, 0.7.3 W8, 0.8.2; `in-scope-routes.json`). */
import type { Routes } from '@angular/router';

import { permissionGuard } from '../../core/auth/permission.guard';
import { SavingsActionComponent } from './savings-actions/savings-action.component';
import { SavingsNewComponent } from './savings-new/savings-new.component';
import { SavingsViewComponent } from './savings-view/savings-view.component';

/** The savings family's three paths under their legacy URLs, lazily mounted by `app.routes.ts`. */
export const SAVINGS_ROUTES: Routes = [{
    path: 'new_client_saving_application/:clientId', component: SavingsNewComponent, canActivate: [permissionGuard], data: {
      permission: 'CREATE_SAVINGSACCOUNT', breadcrumb: ['label.anchor.savings', 'label.heading.savingapplication'], }, }, {
    path: 'viewsavingaccount/:id', component: SavingsViewComponent, canActivate: [permissionGuard], data: {
      permission: 'READ_SAVINGSACCOUNT', breadcrumb: ['label.anchor.savings', 'label.heading.viewsavingaccount'], }, }, {
    path: 'savingaccount/:id/:action', component: SavingsActionComponent, canActivate: [permissionGuard], data: {
      permission: 'READ_SAVINGSACCOUNT', breadcrumb: ['label.anchor.savings', 'label.heading.savingaccount'], }, }, ];
