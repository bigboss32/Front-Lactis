import { Routes } from '@angular/router';

export const RECEPCIONES_ROUTES: Routes = [
  {
    path: '',
    title: 'Recepción de leche | Lactis',
    loadComponent: () => import('./recepcion-list.page').then((m) => m.RecepcionListPage),
  },
];
