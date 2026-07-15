import { Routes } from '@angular/router';

export const PROVEEDORES_ROUTES: Routes = [
  {
    path: '',
    title: 'Proveedores | Lactis',
    loadComponent: () => import('./proveedor-list.page').then((m) => m.ProveedorListPage),
  },
];
