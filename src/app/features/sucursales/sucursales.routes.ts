import { Routes } from '@angular/router';

export const SUCURSALES_ROUTES: Routes = [
  {
    path: '',
    title: 'Sucursales | Lactis',
    loadComponent: () => import('./sucursal-list.page').then((m) => m.SucursalListPage),
  },
];
