import { Routes } from '@angular/router';

export const SUSCRIPCION_ROUTES: Routes = [
  {
    path: '',
    title: 'Suscripción | Lactis',
    loadComponent: () => import('./suscripcion.page').then((m) => m.SuscripcionPage),
  },
];
