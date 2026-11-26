/** The loans feature's six legacy paths, hash-root-relative, mounted by `app.routes.ts` through a pathless `loadChildren` inside the `ShellComponent` layout route, so the five screens land in the lazy loans chunk (AAP (AAP 0.8.2, AAP 0.4.4, AAP 0.10.4, AAP 0.14.1). */
import type { Routes } from '@angular/router';

import { permissionGuard } from '../../core/auth/permission.guard';
import { LoanActionComponent } from './loan-action/loan-action.component';
import { LoanChargeFormComponent } from './loan-charge-form/loan-charge-form.component';
import { LoanEditComponent } from './loan-edit/loan-edit.component';
import { LoanNewComponent } from './loan-new/loan-new.component';
import { LoanViewComponent } from './loan-view/loan-view.component';

/** The loans family's six paths under their legacy URLs, exported as the array `app.routes.ts` loads lazily. */
export const LOANS_ROUTES: Routes = [
  /** Workflow W4, and W7's validation error: the application form with its repayment preview, for the route's `clientId`. */
  {
    path: 'newclientloanaccount/:clientId',
    component: LoanNewComponent,
    canActivate: [permissionGuard],
    data: {
      permission: 'CREATE_LOAN',
      breadcrumb: ['label.anchor.loans', 'label.heading.loanapplication'],
    },
  },
  /** Workflow W4's edit step: the form that changes an application the server has not yet approved, named by the route's `id`. */
  {
    path: 'editloanaccount/:id',
    component: LoanEditComponent,
    canActivate: [permissionGuard],
    data: {
      permission: 'UPDATE_LOAN',
      breadcrumb: ['label.anchor.loans', 'label.heading.editloanaccount'],
    },
  },
  /** The loan record named by the route's `id`: summary, repayment schedule, transactions and charges, and the way into W5 and W6. */
  {
    path: 'viewloanaccount/:id',
    component: LoanViewComponent,
    canActivate: [permissionGuard],
    data: {
      permission: 'READ_LOAN',
      breadcrumb: ['label.anchor.loans', 'label.heading.loanaccount'],
    },
  },
  /** One action's form for the loan the route's `id` names, selected by `action`: approve, undoapproval, reject, disburse and undodisbursal are W5, `repayment` is W6, any other segment renders not-found without posting. */
  {
    path: 'loanaccount/:id/:action',
    component: LoanActionComponent,
    canActivate: [permissionGuard],
    data: {
      permission: 'UPDATE_LOAN',
      breadcrumb: ['label.anchor.loans', 'label.heading.loanaccount'],
    },
  },
  /** The add-charge form for the loan the route's `id` names (AAP 0.7.3 row "Loan charges"). */
  {
    path: 'addloancharge/:id',
    component: LoanChargeFormComponent,
    canActivate: [permissionGuard],
    data: {
      permission: 'UPDATE_LOAN',
      breadcrumb: ['label.anchor.loans', 'label.heading.addloancharge'],
    },
  },
  /** Pay or waive one charge of the loan the route's `id` names: `action` is `pay` or `waive`, `chargeId` is the loan charge's own id (AAP 0.7.3 row "Loan charges"). */
  {
    path: 'loanaccountcharge/:id/:action/:chargeId',
    component: LoanChargeFormComponent,
    canActivate: [permissionGuard],
    data: {
      permission: 'UPDATE_LOAN',
      breadcrumb: ['label.anchor.loans', 'label.heading.loanaccount'],
    },
  },
];
