import { Routes } from '@angular/router';

export const CLIENTES_ROUTES: Routes = [
  {
    path: '',
    title: 'Clientes | Lactis',
    loadComponent: () => import('./cliente-list.page').then((m) => m.ClienteListPage),
  },
];
