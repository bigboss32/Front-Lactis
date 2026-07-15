import { Routes } from '@angular/router';

export const INVENTARIO_ROUTES: Routes = [
  {
    path: '',
    title: 'Inventario | Lactis',
    loadComponent: () => import('./inventario.page').then((m) => m.InventarioPage),
  },
];
