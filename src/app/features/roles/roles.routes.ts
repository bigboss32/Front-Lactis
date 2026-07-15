import { Routes } from '@angular/router';

export const ROLES_ROUTES: Routes = [
  {
    path: '',
    title: 'Roles y permisos | Lactis',
    loadComponent: () => import('./rol-list.page').then((m) => m.RolListPage),
  },
];
