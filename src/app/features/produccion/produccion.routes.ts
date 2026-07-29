import { Routes } from '@angular/router';

export const PRODUCCION_ROUTES: Routes = [
  {
    path: 'lotes',
    title: 'Producción · Utilidad por lote | Lactis',
    loadComponent: () => import('./lotes.page').then((m) => m.ProduccionLotesPage),
  },
  {
    path: '',
    title: 'Producción | Lactis',
    loadComponent: () => import('./produccion.page').then((m) => m.ProduccionPage),
  },
];
