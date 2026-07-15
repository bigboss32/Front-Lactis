import { Routes } from '@angular/router';

export const CAJA_ROUTES: Routes = [
  {
    path: '',
    title: 'Caja | Lactis',
    loadComponent: () => import('./caja-list.page').then((m) => m.CajaListPage),
  },
];
