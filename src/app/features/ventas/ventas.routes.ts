import { Routes } from '@angular/router';

export const VENTAS_ROUTES: Routes = [
  {
    path: '',
    title: 'Ventas | Lactis',
    loadComponent: () => import('./venta-list.page').then((m) => m.VentaListPage),
  },
  {
    path: 'cartera',
    title: 'Cartera | Lactis',
    loadComponent: () => import('./cartera.page').then((m) => m.CarteraPage),
  },
];
