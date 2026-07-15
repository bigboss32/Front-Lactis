import { Routes } from '@angular/router';

export const CONTABILIDAD_ROUTES: Routes = [
  {
    path: '',
    title: 'Contabilidad | Lactis',
    loadComponent: () => import('./contabilidad.page').then((m) => m.ContabilidadPage),
  },
];
