/**
 * The savings feature's route group — the three legacy paths of workflow W8, declared in full and
 * mounted by `app.routes.ts` on the empty path, so each URL is exactly the legacy URL it cuts over
 * (AAP 0.8.2 "Feature routes, matching legacy paths exactly"; AAP 0.7.1 Features row `savings`;
 * AAP 0.7.3 row W8; `web-ng/tools/parity/in-scope-routes.json`).
 *
 * | Path | Screen | Access code |
 * |---|---|---|
 * | `new_client_saving_application/:clientId` | the application form | `CREATE_SAVINGSACCOUNT` |
 * | `viewsavingaccount/:id` | the record, with its summary and transactions | `READ_SAVINGSACCOUNT` |
 * | `savingaccount/:id/:action` | one action's form — `approve`, `activate`, `deposit`, `withdraw` | `READ_SAVINGSACCOUNT` |
 *
 * **The codes the family's screens already state.** `READ_SAVINGSACCOUNT` is the code
 * `SavingsViewComponent` and `SavingsActionComponent` record as the one this family's routes declare,
 * and `CREATE_SAVINGSACCOUNT` is the code the client record gates the "New Saving" entry with — the
 * only two savings codes the plan supplies. The action route therefore declares the read code, exactly
 * as the record's own action links do, so the route gate and the control that leads to it cannot
 * disagree (AAP 0.14.1).
 *
 * Every route states its code in `data['permission']` and its trail in `data['breadcrumb']`
 * (translation keys resolved by the shell against the legacy bundles served in place, Rule 1 clause 6).
 */
import type { Routes } from '@angular/router';

import { permissionGuard } from '../../core/auth/permission.guard';
import { SavingsActionComponent } from './savings-actions/savings-action.component';
import { SavingsNewComponent } from './savings-new/savings-new.component';
import { SavingsViewComponent } from './savings-view/savings-view.component';

/**
 * The savings family's three paths under their legacy URLs.
 *
 * Exported as the array `app.routes.ts` loads lazily, so the family's paths, its access codes and its
 * breadcrumb keys are declared in one place and the parity route list has one thing to agree with.
 */
export const SAVINGS_ROUTES: Routes = [
  {
    path: 'new_client_saving_application/:clientId',
    component: SavingsNewComponent,
    canActivate: [permissionGuard],
    data: {
      permission: 'CREATE_SAVINGSACCOUNT',
      breadcrumb: ['label.anchor.savings', 'label.heading.savingapplication'],
    },
  },
  {
    path: 'viewsavingaccount/:id',
    component: SavingsViewComponent,
    canActivate: [permissionGuard],
    data: {
      permission: 'READ_SAVINGSACCOUNT',
      breadcrumb: ['label.anchor.savings', 'label.heading.viewsavingaccount'],
    },
  },
  {
    path: 'savingaccount/:id/:action',
    component: SavingsActionComponent,
    canActivate: [permissionGuard],
    data: {
      permission: 'READ_SAVINGSACCOUNT',
      breadcrumb: ['label.anchor.savings', 'label.heading.savingaccount'],
    },
  },
];
