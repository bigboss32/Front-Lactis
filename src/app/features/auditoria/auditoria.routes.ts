import { Routes } from '@angular/router';

export const AUDITORIA_ROUTES: Routes = [
  {
    path: '',
    title: 'Auditoría | Lactis',
    loadComponent: () => import('./auditoria.page').then((m) => m.AuditoriaPage),
  },
];
