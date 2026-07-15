import { Routes } from '@angular/router';

export const LIQUIDACIONES_ROUTES: Routes = [
  {
    path: '',
    title: 'Liquidaciones | Lactis',
    loadComponent: () => import('./liquidacion-list.page').then((m) => m.LiquidacionListPage),
  },
];
