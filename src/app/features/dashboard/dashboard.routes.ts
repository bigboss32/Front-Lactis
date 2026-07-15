import { Routes } from '@angular/router';

export const DASHBOARD_ROUTES: Routes = [
  {
    path: '',
    title: 'Dashboard | Lactis',
    loadComponent: () => import('./dashboard.page').then((m) => m.DashboardPage),
  },
];
