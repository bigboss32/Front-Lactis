import { Routes } from '@angular/router';

export const REVENTA_ROUTES: Routes = [
  {
    path: '',
    title: 'Compra y venta de queso | Lactis',
    loadComponent: () => import('./reventa.page').then((m) => m.ReventaPage),
  },
];
