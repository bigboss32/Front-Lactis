import { Routes } from '@angular/router';

export const RUTAS_ROUTES: Routes = [
  {
    path: '',
    title: 'Rutas | Lactis',
    loadComponent: () => import('./ruta-list.page').then((m) => m.RutaListPage),
  },
];
