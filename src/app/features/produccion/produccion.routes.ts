import { Routes } from '@angular/router';

export const PRODUCCION_ROUTES: Routes = [
  {
    path: '',
    title: 'Producción | Lactis',
    loadComponent: () => import('./produccion.page').then((m) => m.ProduccionPage),
  },
];
