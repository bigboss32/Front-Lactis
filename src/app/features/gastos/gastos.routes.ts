import { Routes } from '@angular/router';

export const GASTOS_ROUTES: Routes = [
  {
    path: '',
    title: 'Gastos | Lactis',
    loadComponent: () => import('./gastos.page').then((m) => m.GastosPage),
  },
];
